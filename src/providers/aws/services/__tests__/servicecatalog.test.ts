import { mockClient } from 'aws-sdk-client-mock';
import {
  ServiceCatalogClient,
  ListConstraintsForPortfolioCommand,
  ListPortfoliosCommand,
  ListPrincipalsForPortfolioCommand,
  SearchProductsAsAdminCommand
} from '@aws-sdk/client-service-catalog';
import { ServiceCatalogService } from '../servicecatalog';
import { createService, importIds } from './helpers';

const catalog = mockClient(ServiceCatalogClient);

beforeEach(() => {
  catalog.reset();
  catalog.on(SearchProductsAsAdminCommand).resolves({});
  catalog.on(ListConstraintsForPortfolioCommand).resolves({});
  catalog.on(ListPrincipalsForPortfolioCommand).resolves({});
});

describe('ServiceCatalogService', () => {
  it('imports owned portfolios and products with their associations and constraints', async () => {
    catalog.on(ListPortfoliosCommand)
      .resolvesOnce({ PortfolioDetails: [{ Id: 'port-1', DisplayName: 'Platform' }], NextPageToken: 'p2' })
      .resolvesOnce({
        PortfolioDetails: [{ Id: 'port-ct', DisplayName: 'AWS Control Tower Account Factory Portfolio', ProviderName: 'AWS Control Tower' }]
      });
    catalog.on(SearchProductsAsAdminCommand, { ProductSource: 'ACCOUNT' }).resolves({
      ProductViewDetails: [
        { ProductViewSummary: { ProductId: 'prod-1', Name: 'vpc' } },
        { ProductViewSummary: { ProductId: 'prod-ct', Name: 'AWS Control Tower Account Factory', Owner: 'AWS Control Tower' } }
      ]
    });
    catalog.on(SearchProductsAsAdminCommand, { PortfolioId: 'port-1' }).resolves({
      ProductViewDetails: [{ ProductViewSummary: { ProductId: 'prod-1', Name: 'vpc' } }]
    });
    catalog.on(ListConstraintsForPortfolioCommand, { PortfolioId: 'port-1' }).resolves({
      ConstraintDetails: [{ ConstraintId: 'cons-1', Type: 'LAUNCH', ProductId: 'prod-1' }]
    });
    catalog.on(ListPrincipalsForPortfolioCommand, { PortfolioId: 'port-1' }).resolves({
      Principals: [{ PrincipalARN: 'arn:aws:iam::123456789012:role/Developers', PrincipalType: 'IAM' }]
    });

    const service = createService(ServiceCatalogService, 'servicecatalog');
    await service.initResources();

    expect(importIds(service)).toEqual([
      'aws_servicecatalog_constraint:cons-1',
      'aws_servicecatalog_portfolio:port-1',
      'aws_servicecatalog_principal_portfolio_association:en,arn:aws:iam::123456789012:role/Developers,port-1,IAM',
      'aws_servicecatalog_product:prod-1',
      'aws_servicecatalog_product_portfolio_association:en:port-1:prod-1'
    ]);
    expect(catalog.commandCalls(ListPortfoliosCommand)[1].args[0].input).toMatchObject({ PageToken: 'p2' });
    expect(catalog.commandCalls(ListConstraintsForPortfolioCommand)).toHaveLength(1);
    expect(service.getWarnings()).toEqual([]);
  });
});
