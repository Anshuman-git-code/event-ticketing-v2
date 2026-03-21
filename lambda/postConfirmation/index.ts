import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

export const handler = async (event: {
  userPoolId: string;
  userName: string;
  request: {
    clientMetadata?: Record<string, string>;
  };
}) => {
  const role = event.request.clientMetadata?.role;
  const group = role === 'Organizers' ? 'Organizers' : 'Attendees';

  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName,
    GroupName: group,
  }));

  console.log(`Added user ${event.userName} to group ${group}`);

  // Must return the event unchanged for Cognito triggers
  return event;
};
